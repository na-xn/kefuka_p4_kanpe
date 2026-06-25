#[cfg(windows)]
use tauri::Manager;

/// Windows でウィンドウの WS_EX_NOACTIVATE を付与/解除する。
/// 付与時はクリックしてもフォーカス（アクティブ状態）を奪わない＝オーバーレイ用。
/// 解除時は通常ウィンドウとしてフォーカスでき、テキスト入力ができる。
#[cfg(windows)]
fn apply_noactivate(window: &tauri::WebviewWindow, enabled: bool) -> tauri::Result<()> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };

    let hwnd = window.hwnd()?;
    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let bit = WS_EX_NOACTIVATE.0 as isize;
        let next = if enabled { ex_style | bit } else { ex_style & !bit };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
    }
    Ok(())
}

/// 練習/セッションでテキスト入力やキー操作をしたいときは passive=false にして
/// WS_EX_NOACTIVATE を外し、フォーカスを与える。オーバーレイに戻すときは passive=true。
#[tauri::command]
fn set_overlay_passive(window: tauri::WebviewWindow, passive: bool) {
    #[cfg(windows)]
    {
        let _ = apply_noactivate(&window, passive);
        if !passive {
            let _ = window.set_focus();
        }
    }
    #[cfg(not(windows))]
    {
        // 非Windowsでは no-op（フォーカス挙動は OS 既定）。
        let _ = (&window, passive);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![set_overlay_passive])
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                // 既定はオーバーレイ（フォーカスを奪わない）。
                let _ = apply_noactivate(&window, true);
            }
            #[cfg(not(windows))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
