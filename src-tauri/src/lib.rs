mod db;
mod sync;
mod todo;

use std::sync::Mutex;
use tauri::{
  menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Manager,
};
use tauri_plugin_autostart::ManagerExt;
use todo::{
  add_todo,
  delete_todo,
  initialize_state,
  list_todos,
  reorder_todo,
  toggle_todo,
  update_todo,
};

static CURRENT_LANG: std::sync::LazyLock<Mutex<String>> = std::sync::LazyLock::new(|| Mutex::new("zh".to_string()));

const TRAY_ID: &str = "main-tray";
const MENU_SHOW: &str = "show";
const MENU_AUTOSTART: &str = "autostart";
const MENU_QUIT: &str = "quit";

struct TrayTexts {
  show: &'static str,
  autostart: &'static str,
  quit: &'static str,
  tooltip: &'static str,
}

fn tray_texts_for_lang(lang: &str) -> TrayTexts {
  if lang.starts_with("zh") {
    TrayTexts {
      show: "显示主窗口",
      autostart: "开机自启",
      quit: "退出应用",
      tooltip: "行简",
    }
  } else {
    TrayTexts {
      show: "Show Window",
      autostart: "Auto Start",
      quit: "Quit",
      tooltip: "EasyStep",
    }
  }
}

fn build_tray_menu(app: &tauri::AppHandle, texts: &TrayTexts) -> Result<tauri::menu::Menu<tauri::Wry>, tauri::Error> {
  let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
  let show_item = MenuItemBuilder::with_id(MENU_SHOW, texts.show).build(app)?;
  let autostart_item = CheckMenuItemBuilder::with_id(MENU_AUTOSTART, texts.autostart)
    .checked(autostart_enabled)
    .build(app)?;
  let quit_item = MenuItemBuilder::with_id(MENU_QUIT, texts.quit).build(app)?;
  MenuBuilder::new(app)
    .items(&[&show_item, &autostart_item, &quit_item])
    .build()
}

fn show_main_window(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
  if !(url.starts_with("http://") || url.starts_with("https://")) {
    return Err("仅允许打开 http/https 链接".to_string());
  }

  webbrowser::open(&url)
    .map(|_| ())
    .map_err(|error| format!("打开浏览器失败: {error}"))
}

#[tauri::command]
fn update_tray_language(lang: String, app: tauri::AppHandle) -> Result<(), String> {
  if let Ok(mut cur) = CURRENT_LANG.lock() {
    *cur = lang.clone();
  }
  let texts = tray_texts_for_lang(&lang);
  if let Some(tray) = app.tray_by_id(TRAY_ID) {
    let menu = build_tray_menu(&app, &texts).map_err(|e| format!("{e}"))?;
    tray.set_menu(Some(menu)).map_err(|e| format!("{e}"))?;
    tray.set_tooltip(Some(texts.tooltip)).map_err(|e| format!("{e}"))?;
  }
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      show_main_window(app);
    }))
    .plugin(
      tauri_plugin_autostart::Builder::new()
        .arg("--autostart")
        .build(),
    )
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let app_state = initialize_state(app.handle())
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
      app.manage(app_state);

      let launched_from_autostart = std::env::args().any(|arg| arg == "--autostart");
      if launched_from_autostart {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.hide();
        }
      }

      let texts = tray_texts_for_lang("zh");
      let tray_menu = build_tray_menu(app.handle(), &texts)?;

      TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().cloned().expect("default icon missing"))
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            show_main_window(tray.app_handle());
          }
        })
        .tooltip(texts.tooltip)
        .build(app)?;

      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .on_menu_event(|app, event| match event.id().as_ref() {
      MENU_SHOW => {
        show_main_window(app);
      }
      MENU_AUTOSTART => {
        let next_enabled = !app.autolaunch().is_enabled().unwrap_or(false);
        if next_enabled {
          let _ = app.autolaunch().enable();
        } else {
          let _ = app.autolaunch().disable();
        }

        let lang = CURRENT_LANG.lock().map(|l| l.clone()).unwrap_or_else(|_| "zh".to_string());
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
          let texts = tray_texts_for_lang(&lang);
          let show_item = MenuItemBuilder::with_id(MENU_SHOW, texts.show).build(app).ok();
          let autostart_item = CheckMenuItemBuilder::with_id(MENU_AUTOSTART, texts.autostart)
            .checked(next_enabled)
            .build(app)
            .ok();
          let quit_item = MenuItemBuilder::with_id(MENU_QUIT, texts.quit).build(app).ok();

          if let (Some(si), Some(ai), Some(qi)) = (show_item, autostart_item, quit_item) {
            if let Ok(menu) = MenuBuilder::new(app)
              .items(&[&si, &ai, &qi])
              .build()
            {
              let _ = tray.set_menu(Some(menu));
            }
          }
        }
      }
      MENU_QUIT => {
        app.exit(0);
      }
      _ => {}
    })
    .invoke_handler(tauri::generate_handler![
      list_todos,
      add_todo,
      toggle_todo,
      update_todo,
      delete_todo,
      reorder_todo,
      open_external_url,
      update_tray_language,
      sync::commands::get_sync_config,
      sync::commands::save_sync_config,
      sync::commands::test_sync_connection,
      sync::commands::sync_now,
      sync::commands::get_sync_history
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
