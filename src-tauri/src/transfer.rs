use crate::{
    db::{read_connection, Store},
    domain,
    model::*,
    pdf,
};
use rusqlite::{params, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

pub const MAX_EXPORT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_PDF_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArchiveManifest {
    version: u32,
    profile: Option<Profile>,
    customers: Vec<Customer>,
    drafts: Vec<Draft>,
    issued: Vec<ArchiveInvoice>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    services: Vec<Service>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArchiveInvoice {
    id: String,
    snapshot: Snapshot,
    pdf: String,
    paid: bool,
    #[serde(default)]
    void_reason: String,
}

pub fn encode(data: &Dataset) -> Result<Vec<u8>, String> {
    let mut issued = Vec::with_capacity(data.issued.len());
    for invoice in &data.issued {
        domain::validate_id(&invoice.id)?;
        if invoice.pdf.len() as u64 > MAX_PDF_BYTES {
            return Err("Invalid or oversized invoice PDF".into());
        }
        issued.push(ArchiveInvoice {
            id: invoice.id.clone(),
            snapshot: invoice.snapshot.clone(),
            pdf: format!("pdfs/{}.pdf", invoice.id),
            paid: invoice.paid,
            void_reason: invoice.void_reason.clone(),
        });
    }
    let manifest = ArchiveManifest {
        version: 3,
        profile: data.profile.clone(),
        customers: data.customers.clone(),
        drafts: data.drafts.clone(),
        issued,
        services: data.services.clone(),
    };
    let json = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
    let expanded_size =
        json.len() as u64 + data.issued.iter().map(|i| i.pdf.len() as u64).sum::<u64>();
    if expanded_size > MAX_EXPORT_BYTES {
        return Err("Export exceeds 512 MiB limit".into());
    }
    let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    archive
        .start_file("data.json", options)
        .map_err(|e| e.to_string())?;
    archive.write_all(&json).map_err(|e| e.to_string())?;
    for (entry, invoice) in manifest.issued.iter().zip(&data.issued) {
        archive
            .start_file(&entry.pdf, options)
            .map_err(|e| e.to_string())?;
        archive.write_all(&invoice.pdf).map_err(|e| e.to_string())?;
    }
    let bytes = archive.finish().map_err(|e| e.to_string())?.into_inner();
    if bytes.len() as u64 > MAX_EXPORT_BYTES {
        return Err("Export exceeds 512 MiB limit".into());
    }
    Ok(bytes)
}

fn read_entry(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let file = archive
        .by_name(name)
        .map_err(|e| format!("Invalid ZIP entry {name}: {e}"))?;
    if file.size() > limit {
        return Err("ZIP entry exceeds size limit".into());
    }
    let expected_size = file.size();
    let mut bytes = Vec::new();
    file.take(expected_size + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Invalid ZIP entry {name}: {e}"))?;
    if bytes.len() as u64 != expected_size {
        return Err("ZIP entry size does not match its contents".into());
    }
    Ok(bytes)
}

fn parse_archive(bytes: &[u8]) -> Result<Dataset, String> {
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("Invalid ZIP export: {e}"))?;
    if archive.len() > 10_002 || archive.has_duplicate_names() {
        return Err("ZIP export has too many entries or duplicate names".into());
    }
    let mut names = HashSet::new();
    let mut expanded_size = 0u64;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|e| format!("Invalid ZIP export: {e}"))?;
        let name = file.name().map_err(|e| e.to_string())?.into_owned();
        if file.is_symlink() || file.encrypted() {
            return Err("ZIP export must contain ordinary, unencrypted files".into());
        }
        if name == "pdfs/" && file.size() == 0 {
            continue;
        }
        let limit = if name == "data.json" {
            MAX_EXPORT_BYTES
        } else {
            MAX_PDF_BYTES
        };
        if file.size() > limit || file.size() > MAX_EXPORT_BYTES - expanded_size {
            return Err("ZIP export exceeds expanded size limit".into());
        }
        expanded_size += file.size();
        names.insert(name);
    }
    let manifest: ArchiveManifest =
        serde_json::from_slice(&read_entry(&mut archive, "data.json", MAX_EXPORT_BYTES)?)
            .map_err(|e| format!("Invalid ZIP manifest: {e}"))?;
    if manifest.version != 3 {
        return Err("Unsupported ZIP export version".into());
    }
    names.remove("data.json");
    let mut issued = Vec::with_capacity(manifest.issued.len());
    for invoice in manifest.issued {
        domain::validate_id(&invoice.id)?;
        if invoice.pdf != format!("pdfs/{}.pdf", invoice.id) || !names.remove(&invoice.pdf) {
            return Err("ZIP invoice PDF is missing, duplicated or has an invalid path".into());
        }
        issued.push(Issued {
            pdf: read_entry(&mut archive, &invoice.pdf, MAX_PDF_BYTES)?,
            id: invoice.id,
            snapshot: invoice.snapshot,
            paid: invoice.paid,
            void_reason: invoice.void_reason,
        });
    }
    if !names.is_empty() {
        return Err("ZIP export contains unexpected files".into());
    }
    Ok(Dataset {
        profile: manifest.profile,
        customers: manifest.customers,
        drafts: manifest.drafts,
        issued,
        services: manifest.services,
    })
}

fn pdf_text(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() as u64 > MAX_PDF_BYTES || !bytes.starts_with(b"%PDF-") {
        return Err("Invalid or oversized invoice PDF".into());
    }
    let doc = lopdf::Document::load_mem(bytes).map_err(|e| format!("Invalid invoice PDF: {e}"))?;
    let pages: Vec<u32> = doc.get_pages().keys().copied().collect();
    if pages.is_empty() || pages.len() > 300 {
        return Err("Invalid invoice PDF page count".into());
    }
    let mut objects: Vec<_> = doc.objects.values().collect();
    while let Some(object) = objects.pop() {
        let dict = match object {
            lopdf::Object::Dictionary(dict) => Some(dict),
            lopdf::Object::Stream(stream) => Some(&stream.dict),
            lopdf::Object::Array(items) => {
                objects.extend(items);
                None
            }
            lopdf::Object::Name(name)
                if matches!(
                    name.as_slice(),
                    b"JavaScript"
                        | b"Launch"
                        | b"SubmitForm"
                        | b"ImportData"
                        | b"GoToR"
                        | b"GoToE"
                        | b"URI"
                ) =>
            {
                return Err("Active content is not allowed in invoice PDFs".into());
            }
            _ => None,
        };
        if let Some(dict) = dict {
            for key in [
                b"JS".as_slice(),
                b"JavaScript",
                b"OpenAction",
                b"AA",
                b"EmbeddedFiles",
                b"Launch",
            ] {
                if dict.has(key) {
                    return Err("Active content is not allowed in invoice PDFs".into());
                }
            }
            objects.extend(dict.iter().map(|(_, value)| value));
        }
    }
    let text = doc
        .extract_text_with_limit(&pages, 16 * 1024 * 1024)
        .map_err(|e| format!("Cannot read invoice PDF: {e}"))?;
    Ok(text.split_whitespace().collect::<Vec<_>>().join(" "))
}

pub fn validate(data: &Dataset) -> Result<(), String> {
    if data.profile.is_none() && !data.issued.is_empty() {
        return Err("An export with issued invoices must include the business profile".into());
    }
    if data.services.len() > 100_000
        || data.customers.len() > 10_000
        || data.drafts.len() > 10_000
        || data.issued.len() > 10_000
    {
        return Err("Export has too many records".into());
    }
    if let Some(profile) = &data.profile {
        domain::validate_profile(profile)?;
    }
    let mut service_ids = HashSet::new();
    for service in &data.services {
        domain::validate_service(service)?;
        if !service_ids.insert(&service.id) {
            return Err("Duplicate service ID".into());
        }
    }
    let mut codes = HashSet::new();
    let mut customers = HashMap::new();
    for customer in &data.customers {
        domain::validate_customer(customer)?;
        if !codes.insert(&customer.code) || customers.insert(&customer.id, customer).is_some() {
            return Err("Duplicate customer ID or code".into());
        }
    }
    let mut ids = HashSet::new();
    for draft in &data.drafts {
        domain::validate_saved_draft(draft)?;
        if !ids.insert(&draft.id)
            || (!draft.customer_id.is_empty() && !customers.contains_key(&draft.customer_id))
        {
            return Err("Duplicate draft ID or missing customer".into());
        }
    }
    let mut numbers = HashSet::new();
    let mut sequences: HashMap<&String, HashSet<u32>> = HashMap::new();
    for issued in &data.issued {
        if issued.void_reason.chars().count() > 500
            || issued.void_reason.chars().any(char::is_control)
        {
            return Err(
                "Correction reason must be at most 500 characters without control characters"
                    .into(),
            );
        }
        let s = &issued.snapshot;
        let current = customers
            .get(&s.customer.id)
            .ok_or("Issued invoice customer is missing")?;
        if !ids.insert(&issued.id)
            || issued.id != s.draft.id
            || s.customer.code != current.code
            || !numbers.insert(&s.number)
        {
            return Err("Duplicate or inconsistent issued invoice".into());
        }
        let expected = domain::snapshot(&s.profile, &s.customer, &s.draft, &s.number)?;
        if s.number == "PREVIEW" || expected != *s {
            return Err("Issued invoice snapshot or totals do not match".into());
        }
        let sequence = s.customer.next_number;
        if sequence >= current.next_number
            || !sequences.entry(&current.id).or_default().insert(sequence)
        {
            return Err("Invalid invoice numbering state".into());
        }
        if pdf_text(&issued.pdf)? != pdf_text(&pdf::render(s)?)? {
            return Err("Stored PDF does not match its invoice snapshot".into());
        }
    }
    for customer in &data.customers {
        let count = sequences.get(&customer.id).map_or(0, HashSet::len);
        if u64::from(customer.next_number) != count as u64 + 1 {
            return Err("Invoice history or numbering state is incomplete".into());
        }
    }
    Ok(())
}

pub fn parse(bytes: &[u8]) -> Result<Dataset, String> {
    if bytes.len() as u64 > MAX_EXPORT_BYTES {
        return Err("Export exceeds 512 MiB limit".into());
    }
    let data = parse_archive(bytes)?;
    validate(&data)?;
    Ok(data)
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Destination folder is missing")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary.write_all(bytes).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

impl Store {
    pub fn replace(
        &mut self,
        candidate: &Dataset,
        expected_current: &Dataset,
        recovery_dir: &Path,
    ) -> Result<PathBuf, String> {
        validate(candidate)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let current = read_connection(&tx)?;
        if &current != expected_current {
            return Err("Data changed since confirmation. Review the import again.".into());
        }
        fs::create_dir_all(recovery_dir)
            .map_err(|e| format!("Cannot create recovery folder: {e}"))?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let recovery = recovery_dir.join(format!("recovery-{stamp}.invoice-export.zip"));
        let bytes = encode(&current)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&recovery)
            .map_err(|e| format!("Cannot retain recovery export: {e}"))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("Cannot retain recovery export: {e}"))?;
        #[cfg(unix)]
        {
            fs::File::open(recovery_dir)
                .and_then(|d| d.sync_all())
                .map_err(|e| e.to_string())?;
            if let Some(parent) = recovery_dir.parent() {
                fs::File::open(parent)
                    .and_then(|d| d.sync_all())
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.execute_batch(
            "DELETE FROM issued; DELETE FROM drafts; DELETE FROM customers; DELETE FROM profile; DELETE FROM services;",
        )
        .map_err(|e| e.to_string())?;
        if let Some(profile) = &candidate.profile {
            let mut profile = profile.clone();
            profile.normalize_identifiers();
            tx.execute(
                "INSERT INTO profile(singleton,json) VALUES (1,?1)",
                [serde_json::to_string(&profile).map_err(|e| e.to_string())?],
            )
            .map_err(|e| e.to_string())?;
        }
        for service in &candidate.services {
            tx.execute(
                "INSERT INTO services(id,json) VALUES(?1,?2)",
                params![
                    service.id,
                    serde_json::to_string(service).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        for c in &candidate.customers {
            tx.execute(
                "INSERT INTO customers(id,code,next_number,json) VALUES (?1,?2,?3,?4)",
                params![
                    c.id,
                    c.code,
                    c.next_number,
                    serde_json::to_string(c).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        for d in &candidate.drafts {
            tx.execute(
                "INSERT INTO drafts(id,customer_id,json) VALUES (?1,?2,?3)",
                params![
                    d.id,
                    if d.customer_id.is_empty() {
                        None
                    } else {
                        Some(&d.customer_id)
                    },
                    serde_json::to_string(d).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        for i in &candidate.issued {
            tx.execute("INSERT INTO issued(id,customer_id,number,snapshot,pdf,paid,void_reason) VALUES (?1,?2,?3,?4,?5,?6,?7)", params![i.id,i.snapshot.customer.id,i.snapshot.number,serde_json::to_string(&i.snapshot).map_err(|e| e.to_string())?,i.pdf,i.paid,i.void_reason]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(recovery)
    }
}
