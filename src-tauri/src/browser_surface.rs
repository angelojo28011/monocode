use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewBuilder, WebviewUrl,
};

fn owner_label(caller: &str, requested: Option<&str>) -> Result<String, String> {
    if caller.starts_with("browser_surface_") {
        return Err("Browser content cannot invoke shell browser commands".into());
    }
    if requested.is_some_and(|value| value != caller) {
        return Err("Browser window does not match command caller".into());
    }
    Ok(caller.to_string())
}

fn owner(caller: &Webview, requested: Option<String>) -> Result<String, String> {
    // Check the actual IPC Webview, not only the trusted window containing it.
    owner_label(caller.label(), None)?;
    owner_label(caller.window().label(), requested.as_deref())
}

fn tab_key(tab_id: Option<String>) -> Result<String, String> {
    let key = tab_id.unwrap_or_else(|| "legacy".into());
    if key.is_empty()
        || key.len() > 128
        || !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("Invalid browser tab identity".into());
    }
    Ok(key)
}

fn browser_prefix(owner: &str) -> String {
    format!("browser_surface_{}_{owner}_", owner.len())
}

fn browser_label(owner: &str, tab: &str) -> String {
    format!("{}{tab}", browser_prefix(owner))
}

fn web_url(raw: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw).map_err(|e| format!("Invalid URL: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Only HTTP and HTTPS URLs are supported".into());
    }
    Ok(parsed)
}

fn validate_bounds(x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if ![x, y, width, height].iter().all(|v| v.is_finite()) || width < 0.0 || height < 0.0 {
        return Err("Invalid browser bounds".into());
    }
    Ok(())
}

async fn dispatch<F>(app: AppHandle, task: F) -> Result<(), String>
where
    F: FnOnce(AppHandle) -> Result<(), String> + Send + 'static,
{
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.blocking_send(task(handle));
    })
    .map_err(|e| format!("Failed to dispatch browser command: {e}"))?;
    rx.recv()
        .await
        .ok_or_else(|| "Browser command channel closed".to_string())?
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Navigation {
    window_label: String,
    tab_id: String,
    url: String,
    loading: Option<bool>,
    title: Option<String>,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    can_go_back: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    can_go_forward: Option<bool>,
}

fn emit_navigation(wv: &Webview, event: Navigation) -> tauri::Result<()> {
    let app = wv.app_handle().clone();
    #[cfg(windows)]
    {
        let fallback = event.clone();
        let fallback_app = app.clone();
        let result = wv.with_webview(move |platform| {
            let mut event = event;
            // The controller belongs to this child; with_webview dispatches on its UI thread.
            unsafe {
                if let Ok(core) = platform.controller().CoreWebView2() {
                    let mut back = Default::default();
                    let mut forward = Default::default();
                    if core.CanGoBack(&mut back).is_ok() {
                        event.can_go_back = Some(back.as_bool());
                    }
                    if core.CanGoForward(&mut forward).is_ok() {
                        event.can_go_forward = Some(forward.as_bool());
                    }
                }
            }
            let _ = app.emit_to(event.window_label.clone(), "browser-navigation", event);
        });
        if result.is_err() {
            return fallback_app.emit_to(
                fallback.window_label.clone(),
                "browser-navigation",
                fallback,
            );
        }
        result
    }
    #[cfg(not(windows))]
    app.emit_to(event.window_label.clone(), "browser-navigation", event)
}

#[tauri::command]
pub async fn browser_sync_bounds(
    app: AppHandle,
    webview: Webview,
    window_label: Option<String>,
    tab_id: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
    url: Option<String>,
) -> Result<(), String> {
    let owner = owner(&webview, window_label)?;
    let tab = tab_key(tab_id)?;
    if url.is_some() {
        return Err("Browser bounds do not support url; use browser_navigate".into());
    }
    validate_bounds(x, y, width, height)?;
    dispatch(app, move |app| {
        if let Some(wv) = app.get_webview(&browser_label(&owner, &tab)) {
            wv.set_position(LogicalPosition::new(x, y))
                .map_err(|e| e.to_string())?;
            wv.set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))
                .map_err(|e| e.to_string())?;
            if visible && width > 0.0 && height > 0.0 {
                wv.show()
            } else {
                wv.hide()
            }
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn browser_navigate(
    app: AppHandle,
    webview: Webview,
    window_label: Option<String>,
    tab_id: Option<String>,
    url: String,
    restore: Option<bool>,
) -> Result<(), String> {
    let owner = owner(&webview, window_label)?;
    let tab = tab_key(tab_id)?;
    let parsed = web_url(&url)?;
    dispatch(app, move |app| {
        let label = browser_label(&owner, &tab);
        if let Some(wv) = app.get_webview(&label) {
            if restore.unwrap_or(false) {
                let current = wv.url().map_err(|e| e.to_string())?;
                emit_navigation(
                    &wv,
                    Navigation {
                        window_label: owner,
                        tab_id: tab,
                        url: current.to_string(),
                        kind: "restore",
                        can_go_back: None,
                        can_go_forward: None,
                        loading: None,
                        title: None,
                    },
                )
                .map_err(|e| e.to_string())?;
                return Ok(());
            }
            return wv
                .navigate(parsed)
                .map_err(|e| format!("Failed to navigate: {e}"));
        }
        let win = app
            .get_window(&owner)
            .ok_or("Browser owner window no longer exists")?;
        let event_owner = owner.clone();
        let event_tab = tab.clone();
        let title_owner = owner.clone();
        let title_tab = tab.clone();
        let navigation_owner = owner.clone();
        let navigation_tab = tab.clone();
        let navigation_handle = app.clone();
        // Identity is captured at creation, never read from the currently selected React tab.
        // External content receives no remote capability or injected privileged bridge.
        let builder = WebviewBuilder::new(label, WebviewUrl::External(parsed))
            .on_navigation(move |url| {
                if !matches!(url.scheme(), "http" | "https") {
                    return false;
                }
                let _ = navigation_handle.emit_to(
                    navigation_owner.clone(),
                    "browser-navigation",
                    Navigation {
                        window_label: navigation_owner.clone(),
                        tab_id: navigation_tab.clone(),
                        url: url.to_string(),
                        kind: "navigation",
                        can_go_back: None,
                        can_go_forward: None,
                        loading: None,
                        title: None,
                    },
                );
                true
            })
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_page_load(move |wv, payload| {
                let _ = emit_navigation(
                    &wv,
                    Navigation {
                        window_label: event_owner.clone(),
                        tab_id: event_tab.clone(),
                        url: payload.url().to_string(),
                        kind: "load",
                        can_go_back: None,
                        can_go_forward: None,
                        loading: Some(matches!(
                            payload.event(),
                            tauri::webview::PageLoadEvent::Started
                        )),
                        title: None,
                    },
                );
            })
            .on_document_title_changed(move |wv, title| {
                if let Ok(url) = wv.url() {
                    let _ = emit_navigation(
                        &wv,
                        Navigation {
                            window_label: title_owner.clone(),
                            tab_id: title_tab.clone(),
                            url: url.to_string(),
                            kind: "title",
                            can_go_back: None,
                            can_go_forward: None,
                            loading: None,
                            title: Some(title),
                        },
                    );
                }
            });
        let wv = win
            .add_child(
                builder,
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1.0, 1.0),
            )
            .map_err(|e| format!("Failed to create browser webview: {e}"))?;
        // Creation never shows content: only active, non-occluded bounds updates may show it.
        wv.hide().map_err(|e| e.to_string())
    })
    .await
}

async fn action(
    app: AppHandle,
    webview: Webview,
    window_label: Option<String>,
    tab_id: Option<String>,
    operation: &'static str,
) -> Result<(), String> {
    let owner = owner(&webview, window_label)?;
    let all_tabs = tab_id.is_none() && matches!(operation, "hide" | "close");
    let tab = tab_key(tab_id)?;
    dispatch(app, move |app| {
        let views: Vec<_> = if all_tabs {
            app.webviews()
                .into_values()
                .filter(|wv| {
                    wv.window().label() == owner && wv.label().starts_with(&browser_prefix(&owner))
                })
                .collect()
        } else {
            app.get_webview(&browser_label(&owner, &tab))
                .into_iter()
                .collect()
        };
        if views.is_empty() && !matches!(operation, "hide" | "close") {
            return Err("Browser webview is not initialized yet".into());
        }
        for wv in views {
            match operation {
                "hide" => wv.hide(),
                "show" => wv.show(),
                "close" => wv.close(),
                "reload" => wv.reload(),
                "back" => wv.eval("window.history.back()"),
                "forward" => wv.eval("window.history.forward()"),
                _ => unreachable!(),
            }
            .map_err(|e| format!("Browser {operation} failed: {e}"))?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn browser_hide(
    app: AppHandle,
    webview: Webview,
    window_label: Option<String>,
    tab_id: Option<String>,
) -> Result<(), String> {
    action(app, webview, window_label, tab_id, "hide").await
}
#[tauri::command]
pub async fn browser_show(
    app: AppHandle,
    webview: Webview,
    window_label: Option<String>,
    tab_id: Option<String>,
) -> Result<(), String> {
    action(app, webview, window_label, tab_id, "show").await
}
#[tauri::command]
pub async fn browser_reload(
    app: AppHandle,
    webview: Webview,
    window_label: Option<String>,
    tab_id: Option<String>,
) -> Result<(), String> {
    action(app, webview, window_label, tab_id, "reload").await
}
#[tauri::command]
pub async fn browser_go_back(
    app: AppHandle,
    webview: Webview,
    window_label: Option<String>,
    tab_id: Option<String>,
) -> Result<(), String> {
    action(app, webview, window_label, tab_id, "back").await
}
#[tauri::command]
pub async fn browser_go_forward(
    app: AppHandle,
    webview: Webview,
    window_label: Option<String>,
    tab_id: Option<String>,
) -> Result<(), String> {
    action(app, webview, window_label, tab_id, "forward").await
}
#[tauri::command]
pub async fn browser_close(
    app: AppHandle,
    webview: Webview,
    window_label: Option<String>,
    tab_id: Option<String>,
) -> Result<(), String> {
    action(app, webview, window_label, tab_id, "close").await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_urls_reject_invalid_and_non_http_schemes() {
        for raw in [
            "javascript:alert(1)",
            "file:///tmp/test",
            "data:text/plain,test",
            "about:blank",
            "https://",
            "not a url",
        ] {
            assert!(web_url(raw).is_err(), "{raw}");
        }
        for raw in ["http://localhost:5173/path", "https://example.com"] {
            assert!(web_url(raw).is_ok(), "{raw}");
        }
    }

    #[test]
    fn browser_child_label_is_not_a_trusted_shell_caller() {
        assert_eq!(
            owner_label(&browser_label("main", "first"), None).unwrap_err(),
            "Browser content cannot invoke shell browser commands"
        );
    }

    #[test]
    fn ownership_cannot_fall_back_to_a_different_window() {
        assert_eq!(owner_label("workspace-2", None).unwrap(), "workspace-2");
        assert_eq!(
            owner_label("workspace-2", Some("workspace-2")).unwrap(),
            "workspace-2"
        );
        assert_eq!(
            owner_label("workspace-2", Some("main")).unwrap_err(),
            "Browser window does not match command caller"
        );
        assert_ne!(
            browser_label("main", "first"),
            browser_label("main", "second")
        );
        assert_ne!(
            browser_label("main", "first"),
            browser_label("workspace-2", "first")
        );
        assert!(tab_key(Some("../../main".into())).is_err());
    }

    #[test]
    fn bounds_require_finite_values_and_nonnegative_dimensions() {
        assert!(validate_bounds(-10.0, 0.0, 0.0, 100.0).is_ok());
        for bounds in [
            (f64::NAN, 0.0, 1.0, 1.0),
            (0.0, f64::INFINITY, 1.0, 1.0),
            (0.0, 0.0, -1.0, 1.0),
            (0.0, 0.0, 1.0, f64::NEG_INFINITY),
        ] {
            assert_eq!(
                validate_bounds(bounds.0, bounds.1, bounds.2, bounds.3).unwrap_err(),
                "Invalid browser bounds"
            );
        }
    }
}
