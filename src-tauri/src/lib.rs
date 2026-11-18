pub mod catalogue;
pub mod db;
pub mod domain;
mod format;
pub mod invoices;
pub mod model;
pub mod pdf;
mod pdf_layout;
mod pdf_subset;
pub mod summary;
pub mod transfer;

use model::*;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};

struct AppState {
    store: Mutex<db::Store>,
    pending: Mutex<Option<(Dataset, Dataset)>>,
    directory: PathBuf,
    #[cfg(debug_assertions)]
    test_dialogs: Mutex<Option<std::collections::VecDeque<Option<PathBuf>>>>,
}
type Shared<'a> = State<'a, Arc<AppState>>;

fn choose_file(
    state: &AppState,
    title: &str,
    name: &str,
    extensions: &[&str],
    save: bool,
) -> Result<Option<PathBuf>, String> {
    #[cfg(debug_assertions)]
    if let Some(queue) = state
        .test_dialogs
        .lock()
        .map_err(|_| "Test dialog state unavailable")?
        .as_mut()
    {
        return queue
            .pop_front()
            .ok_or_else(|| "Acceptance dialog queue is exhausted".into());
    }
    let _ = state;
    let dialog = rfd::FileDialog::new()
        .set_title(title)
        .set_file_name(name)
        .add_filter(extensions.join(", "), extensions);
    Ok(if save {
        dialog.save_file()
    } else {
        dialog.pick_file()
    })
}

async fn work<T: Send + 'static>(
    state: Arc<AppState>,
    operation: impl FnOnce(&AppState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || operation(&state))
        .await
        .map_err(|e| e.to_string())?
}

fn lock_store(state: &AppState) -> Result<std::sync::MutexGuard<'_, db::Store>, String> {
    state
        .store
        .lock()
        .map_err(|_| "Storage is unavailable; restart Invoice".into())
}

#[tauri::command]
async fn load(state: Shared<'_>) -> Result<Dataset, String> {
    work(state.inner().clone(), |s| lock_store(s)?.read()).await
}

#[tauri::command]
async fn workspace(state: Shared<'_>) -> Result<catalogue::Workspace, String> {
    work(state.inner().clone(), |s| lock_store(s)?.workspace()).await
}
#[tauri::command]
async fn search_invoices(
    state: Shared<'_>,
    query: catalogue::SearchQuery,
) -> Result<catalogue::Page<catalogue::InvoiceSummary>, String> {
    work(state.inner().clone(), move |s| {
        lock_store(s)?.search_invoices(&query)
    })
    .await
}
#[tauri::command]
async fn invoice_summary(
    state: Shared<'_>,
    range: summary::DateRange,
    today: String,
) -> Result<summary::InvoiceReport, String> {
    work(state.inner().clone(), move |s| {
        lock_store(s)?.invoice_summary(&range, &today)
    })
    .await
}
#[tauri::command]
async fn search_customers(
    state: Shared<'_>,
    query: catalogue::SearchQuery,
) -> Result<catalogue::Page<Customer>, String> {
    work(state.inner().clone(), move |s| {
        lock_store(s)?.search_customers(&query)
    })
    .await
}
#[tauri::command]
async fn search_services(
    state: Shared<'_>,
    query: catalogue::SearchQuery,
) -> Result<catalogue::Page<Service>, String> {
    work(state.inner().clone(), move |s| {
        lock_store(s)?.search_services(&query)
    })
    .await
}
#[tauri::command]
async fn get_customer(state: Shared<'_>, id: String) -> Result<catalogue::CustomerDetail, String> {
    work(state.inner().clone(), move |s| lock_store(s)?.customer(&id)).await
}
#[tauri::command]
async fn customer_code_available(
    state: Shared<'_>,
    code: String,
    id: String,
) -> Result<bool, String> {
    work(state.inner().clone(), move |s| {
        lock_store(s)?.customer_code_available(&code, &id)
    })
    .await
}
#[tauri::command]
async fn get_draft(state: Shared<'_>, id: String) -> Result<Draft, String> {
    work(state.inner().clone(), move |s| lock_store(s)?.draft(&id)).await
}
#[tauri::command]
async fn get_issued(state: Shared<'_>, id: String) -> Result<Issued, String> {
    work(state.inner().clone(), move |s| {
        lock_store(s)?.issued_snapshot(&id)
    })
    .await
}
#[tauri::command]
async fn save_service(state: Shared<'_>, service: Service) -> Result<(), String> {
    work(state.inner().clone(), move |s| {
        lock_store(s)?.save_service(service)
    })
    .await
}
#[tauri::command]
async fn delete_service(state: Shared<'_>, id: String) -> Result<(), String> {
    work(state.inner().clone(), move |s| {
        lock_store(s)?.delete_service(&id)
    })
    .await
}

#[tauri::command]
async fn save_profile(state: Shared<'_>, profile: Profile) -> Result<(), String> {
    work(state.inner().clone(), move |s| {
        lock_store(s)?.save_profile(profile)
    })
    .await
}

#[tauri::command]
async fn save_customer(state: Shared<'_>, customer: Customer) -> Result<(), String> {
    work(state.inner().clone(), move |s| {
        lock_store(s)?.save_customer(customer)
    })
    .await
}

#[tauri::command]
async fn save_draft(state: Shared<'_>, draft: Draft) -> Result<(), String> {
    work(state.inner().clone(), move |s| {
        let mut store = lock_store(s)?;
        store.validate_saved_service_lines(&draft)?;
        store.save_draft(draft)
    })
    .await
}

#[tauri::command]
async fn delete_draft(state: Shared<'_>, id: String) -> Result<(), String> {
    work(state.inner().clone(), move |s| {
        lock_store(s)?.delete_draft(&id)
    })
    .await
}

#[tauri::command]
async fn preview(state: Shared<'_>, id: String) -> Result<Snapshot, String> {
    work(state.inner().clone(), move |s| lock_store(s)?.preview(&id)).await
}

#[derive(serde::Serialize)]
struct PdfPreview {
    snapshot: Snapshot,
    pdf: String,
}

#[tauri::command]
async fn preview_draft(state: Shared<'_>, draft: Draft) -> Result<PdfPreview, String> {
    work(state.inner().clone(), move |s| {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let store = lock_store(s)?;
        store.validate_service_lines(&draft)?;
        let snapshot = store.preview_draft(&draft)?;
        let pdf = STANDARD.encode(pdf::render(&snapshot)?);
        Ok(PdfPreview { snapshot, pdf })
    })
    .await
}

#[tauri::command]
async fn read_pdf(state: Shared<'_>, id: String) -> Result<String, String> {
    work(state.inner().clone(), move |s| {
        use base64::{engine::general_purpose::STANDARD, Engine};
        Ok(STANDARD.encode(document(s, &id, false)?.1))
    })
    .await
}

#[tauri::command]
async fn issue(state: Shared<'_>, id: String) -> Result<(), String> {
    work(state.inner().clone(), move |s| {
        let mut store = lock_store(s)?;
        if let Ok(draft) = store.draft(&id) {
            store.validate_service_lines(&draft)?;
        }
        store.issue(&id).map(|_| ())
    })
    .await
}

#[tauri::command]
async fn correct_invoice(
    state: Shared<'_>,
    id: String,
    new_id: String,
    reason: String,
) -> Result<(), String> {
    work(state.inner().clone(), move |s| {
        lock_store(s)?.correct_invoice(&id, &new_id, &reason)
    })
    .await
}

#[tauri::command]
async fn set_paid(state: Shared<'_>, id: String, paid: bool) -> Result<(), String> {
    work(state.inner().clone(), move |s| {
        lock_store(s)?.set_paid(&id, paid)
    })
    .await
}

fn document(state: &AppState, id: &str, draft: bool) -> Result<(String, Vec<u8>), String> {
    domain::validate_id(id)?;
    let store = lock_store(state)?;
    if draft {
        let snapshot = store.preview(id)?;
        Ok((format!("draft-{id}"), pdf::render(&snapshot)?))
    } else {
        store.issued_pdf(id)
    }
}

fn destination(state: &AppState, path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("Destination folder is missing")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let directory = state.directory.canonicalize().map_err(|e| e.to_string())?;
    if parent.starts_with(directory) {
        return Err("Choose a folder outside the application's private data folder".into());
    }
    Ok(())
}

#[tauri::command]
async fn save_pdf(state: Shared<'_>, id: String, draft: bool) -> Result<Option<String>, String> {
    work(state.inner().clone(), move |s| {
        let (name, bytes) = document(s, &id, draft)?;
        let Some(path) = choose_file(
            s,
            "Save invoice PDF",
            &format!("{name}.pdf"),
            &["pdf"],
            true,
        )?
        else {
            return Ok(None);
        };
        destination(s, &path)?;
        transfer::write_atomic(&path, &bytes)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}

#[tauri::command]
async fn open_pdf(state: Shared<'_>, id: String, draft: bool) -> Result<(), String> {
    work(state.inner().clone(), move |s| {
        let (name, bytes) = document(s, &id, draft)?;
        let directory = s.directory.join("pdf-preview");
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let path = directory.join(format!("{name}.pdf"));
        transfer::write_atomic(&path, &bytes)?;
        open::that(&path)
            .map_err(|e| format!("Could not open PDF viewer; use Save PDF instead: {e}"))
    })
    .await
}

#[tauri::command]
async fn export_data(state: Shared<'_>) -> Result<Option<String>, String> {
    work(state.inner().clone(), |s| {
        let Some(path) = choose_file(
            s,
            "Export all Invoice data",
            "invoice-data.invoice-export.zip",
            &["zip"],
            true,
        )?
        else {
            return Ok(None);
        };
        destination(s, &path)?;
        let data = lock_store(s)?.read()?;
        let bytes = transfer::encode(&data)?;
        transfer::write_atomic(&path, &bytes)?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as u64;
        let record = serde_json::json!({"exportedAt":stamp,"path":path.to_string_lossy()});
        transfer::write_atomic(
            &s.directory.join("last-backup.json"),
            &serde_json::to_vec(&record).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("Backup saved, but its status could not be recorded: {e}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportSummary {
    services: usize,
    customers: usize,
    drafts: usize,
    issued: usize,
}

fn check_preferences(contents: &str) -> Result<(), String> {
    if contents.len() > 65536 {
        return Err("Preferences file exceeds 64 KiB".into());
    }
    let value: serde_json::Value = serde_json::from_str(contents).map_err(|e| e.to_string())?;
    if value["format"] != "invoice-preferences" || value["version"] != 1 {
        return Err("Unsupported Invoice preferences file or version".into());
    }
    Ok(())
}

#[test]
fn preference_files_require_a_supported_bounded_envelope() {
    assert!(check_preferences(r#"{"format":"invoice-preferences","version":1}"#).is_ok());
    for contents in ["[]", "{", r#"{"format":"invoice-preferences","version":2}"#] {
        assert!(check_preferences(contents).is_err());
    }
    assert!(check_preferences(&" ".repeat(65537)).is_err());
}

#[tauri::command]
async fn export_preferences(state: Shared<'_>, contents: String) -> Result<Option<String>, String> {
    work(state.inner().clone(), move |s| {
        check_preferences(&contents)?;
        let Some(path) = choose_file(
            s,
            "Export Invoice preferences",
            "invoice-preferences.json",
            &["json"],
            true,
        )?
        else {
            return Ok(None);
        };
        destination(s, &path)?;
        transfer::write_atomic(&path, contents.as_bytes())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}

#[tauri::command]
async fn import_preferences(state: Shared<'_>) -> Result<Option<String>, String> {
    work(state.inner().clone(), |s| {
        let Some(path) = choose_file(s, "Import Invoice preferences", "", &["json"], false)? else {
            return Ok(None);
        };
        let mut contents = String::new();
        fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(65537)
            .read_to_string(&mut contents)
            .map_err(|e| e.to_string())?;
        check_preferences(&contents)?;
        Ok(Some(contents))
    })
    .await
}

#[tauri::command]
async fn prepare_import(state: Shared<'_>) -> Result<Option<ImportSummary>, String> {
    work(state.inner().clone(), |s| {
        *s.pending.lock().map_err(|_| "Import state unavailable")? = None;
        let Some(path) = choose_file(s, "Choose Invoice export to restore", "", &["zip"], false)?
        else {
            return Ok(None);
        };
        let file = fs::File::open(path).map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() > transfer::MAX_EXPORT_BYTES {
            return Err("Export exceeds 512 MiB limit".into());
        }
        let mut bytes = Vec::new();
        file.take(transfer::MAX_EXPORT_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let candidate = transfer::parse(&bytes)?;
        let summary = ImportSummary {
            services: candidate.services.len(),
            customers: candidate.customers.len(),
            drafts: candidate.drafts.len(),
            issued: candidate.issued.len(),
        };
        let current = lock_store(s)?.read()?;
        *s.pending.lock().map_err(|_| "Import state unavailable")? = Some((candidate, current));
        Ok(Some(summary))
    })
    .await
}

#[tauri::command]
async fn cancel_import(state: Shared<'_>) -> Result<(), String> {
    *state
        .pending
        .lock()
        .map_err(|_| "Import state unavailable")? = None;
    Ok(())
}

#[tauri::command]
async fn confirm_import(state: Shared<'_>) -> Result<String, String> {
    work(state.inner().clone(), |s| {
        let (candidate, current) = s
            .pending
            .lock()
            .map_err(|_| "Import state unavailable")?
            .take()
            .ok_or("Choose and review an export first")?;
        let recovery =
            lock_store(s)?.replace(&candidate, &current, &s.directory.join("recovery"))?;
        Ok(recovery.to_string_lossy().into_owned())
    })
    .await
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupStatus {
    exported_at: u64,
    path: String,
    #[serde(default)]
    available: bool,
}

#[tauri::command]
fn backup_status(state: Shared<'_>) -> Result<Option<BackupStatus>, String> {
    let path = state.directory.join("last-backup.json");
    match fs::read(path) {
        Ok(bytes) => {
            let mut record: BackupStatus =
                serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            record.available = Path::new(&record.path).is_file();
            Ok(Some(record))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn data_location(state: Shared<'_>) -> String {
    state.directory.to_string_lossy().into_owned()
}

fn check_location(path: &Path, directory: bool) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("An absolute file-system path is required".into());
    }
    let metadata = fs::metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "This file or folder is no longer available at this location".to_owned()
        } else {
            format!("Could not access this location: {error}")
        }
    })?;
    if directory && !metadata.is_dir() {
        return Err("This location is not a folder".into());
    }
    if !directory && !metadata.is_file() {
        return Err("This location is not a file".into());
    }
    Ok(())
}

#[tauri::command]
async fn show_location(path: PathBuf, directory: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_location(&path, directory)?;
        if directory {
            open::that(&path).map_err(|error| error.to_string())
        } else {
            tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|error| error.to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[test]
fn file_locations_require_existing_absolute_paths_of_the_requested_kind() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("Invoice #1 & café.pdf");
    fs::write(&file, b"fixture").unwrap();
    assert!(check_location(&file, false).is_ok());
    assert!(check_location(directory.path(), true).is_ok());
    assert_eq!(
        check_location(&file, true).unwrap_err(),
        "This location is not a folder"
    );
    assert_eq!(
        check_location(directory.path(), false).unwrap_err(),
        "This location is not a file"
    );
    for path in [
        "",
        "relative.pdf",
        "https://example.com",
        "file:///tmp/invoice.pdf",
    ] {
        assert_eq!(
            check_location(Path::new(path), false).unwrap_err(),
            "An absolute file-system path is required"
        );
    }
    fs::remove_file(&file).unwrap();
    assert_eq!(
        check_location(&file, false).unwrap_err(),
        "This file or folder is no longer available at this location"
    );
}

pub fn run() {
    let result = tauri::Builder::default()
        .setup(|app| {
            let mut directory = app.path().app_data_dir()?;
            if cfg!(debug_assertions) {
                if let Some(test_directory) = std::env::var_os("INVOICE_DATA_DIR") {
                    directory = PathBuf::from(test_directory);
                }
            }
            fs::create_dir_all(&directory)?;
            let store = db::Store::open(&directory.join("invoice-v2.sqlite"))
                .map_err(std::io::Error::other)?;
            app.manage(Arc::new(AppState {
                store: Mutex::new(store),
                pending: Mutex::new(None),
                directory,
                #[cfg(debug_assertions)]
                test_dialogs: Mutex::new(
                    std::env::var("INVOICE_TEST_DIALOGS")
                        .ok()
                        .map(|value| serde_json::from_str(&value))
                        .transpose()?,
                ),
            }));
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load,
            workspace,
            search_invoices,
            invoice_summary,
            search_customers,
            search_services,
            get_customer,
            customer_code_available,
            get_draft,
            get_issued,
            save_service,
            delete_service,
            save_profile,
            save_customer,
            save_draft,
            delete_draft,
            preview,
            preview_draft,
            read_pdf,
            issue,
            set_paid,
            correct_invoice,
            save_pdf,
            open_pdf,
            export_data,
            export_preferences,
            import_preferences,
            prepare_import,
            cancel_import,
            confirm_import,
            backup_status,
            show_location,
            data_location
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        rfd::MessageDialog::new()
            .set_title("Invoice could not start")
            .set_description(format!("Your data has not been replaced. {error}"))
            .set_level(rfd::MessageLevel::Error)
            .show();
    }
}
