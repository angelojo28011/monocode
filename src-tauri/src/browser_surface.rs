use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

const BROWSER_WEBVIEW_LABEL: &str = "browser_surface";

#[tauri::command]
pub async fn browser_sync_bounds(
    app: AppHandle,
    window_label: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
    url: Option<String>,
) -> Result<(), String> {
    let (tx, rx) = tauri::async_runtime::channel(1);
    let app_handle = app.clone();

    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            let win = window_label
                .as_deref()
                .and_then(|label| app_handle.get_window(label))
                .or_else(|| app_handle.get_window("main"))
                .or_else(|| {
                    crate::window::workspace_windows(&app_handle)
                        .first()
                        .and_then(|ww| app_handle.get_window(ww.label()))
                })
                .or_else(|| {
                    app_handle
                        .webview_windows()
                        .values()
                        .next()
                        .and_then(|ww| app_handle.get_window(ww.label()))
                })
                .ok_or_else(|| "No workspace window found to attach webview".to_string())?;

            let pos = LogicalPosition::new(x.max(0.0), y.max(0.0));
            let size = LogicalSize::new(width.max(1.0), height.max(1.0));

            if let Some(wv) = app_handle.get_webview(BROWSER_WEBVIEW_LABEL) {
                let _ = wv.set_position(pos);
                let _ = wv.set_size(size);
                if visible {
                    let _ = wv.show();
                } else {
                    let _ = wv.hide();
                }

                if let Some(target_url) = url {
                    if !target_url.trim().is_empty() {
                        if let Ok(parsed) = target_url.parse() {
                            let _ = wv.navigate(parsed);
                        }
                    }
                }
            } else if visible && width > 10.0 && height > 10.0 {
                let initial_url = url
                    .filter(|u| !u.trim().is_empty())
                    .unwrap_or_else(|| "https://www.google.com".to_string());

                let parsed_url: url::Url = initial_url
                    .parse()
                    .map_err(|e| format!("Invalid URL: {e}"))?;

                let builder = WebviewBuilder::new(
                    BROWSER_WEBVIEW_LABEL,
                    WebviewUrl::External(parsed_url),
                );

                win.add_child(builder, pos, size)
                    .map_err(|e| format!("Failed to create browser webview: {e}"))?;
            }

            Ok(())
        })();

        let _ = tx.blocking_send(result);
    })
    .map_err(|e| format!("Failed to dispatch on main thread: {e}"))?;

    let mut rx = rx;
    rx.recv().await.ok_or_else(|| "Channel closed".to_string())?
}


#[tauri::command]
pub async fn browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
    let parsed: url::Url = url
        .parse()
        .map_err(|e| format!("Invalid URL '{url}': {e}"))?;

    let (tx, rx) = tauri::async_runtime::channel(1);
    let app_handle = app.clone();

    app.run_on_main_thread(move || {
        let result = if let Some(wv) = app_handle.get_webview(BROWSER_WEBVIEW_LABEL) {
            let _ = wv.show();
            wv.navigate(parsed)
                .map_err(|e| format!("Failed to navigate: {e}"))
        } else {
            Err("Browser webview is not initialized yet".into())
        };
        let _ = tx.blocking_send(result);
    })
    .map_err(|e| format!("Failed to dispatch on main thread: {e}"))?;

    let mut rx = rx;
    rx.recv().await.ok_or_else(|| "Channel closed".to_string())?
}


#[tauri::command]
pub fn browser_hide(app: AppHandle) -> Result<(), String> {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(wv) = app_handle.get_webview(BROWSER_WEBVIEW_LABEL) {
            let _ = wv.hide();
        }
    });
    Ok(())
}

#[tauri::command]
pub fn browser_show(app: AppHandle) -> Result<(), String> {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(wv) = app_handle.get_webview(BROWSER_WEBVIEW_LABEL) {
            let _ = wv.show();
        }
    });
    Ok(())
}

#[tauri::command]
pub fn browser_reload(app: AppHandle) -> Result<(), String> {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(wv) = app_handle.get_webview(BROWSER_WEBVIEW_LABEL) {
            let _ = wv.eval("window.location.reload()");
        }
    });
    Ok(())
}

#[tauri::command]
pub fn browser_go_back(app: AppHandle) -> Result<(), String> {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(wv) = app_handle.get_webview(BROWSER_WEBVIEW_LABEL) {
            let _ = wv.eval("window.history.back()");
        }
    });
    Ok(())
}

#[tauri::command]
pub fn browser_go_forward(app: AppHandle) -> Result<(), String> {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(wv) = app_handle.get_webview(BROWSER_WEBVIEW_LABEL) {
            let _ = wv.eval("window.history.forward()");
        }
    });
    Ok(())
}

#[tauri::command]
pub fn browser_close(app: AppHandle) -> Result<(), String> {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(wv) = app_handle.get_webview(BROWSER_WEBVIEW_LABEL) {
            let _ = wv.close();
        }
    });
    Ok(())
}
