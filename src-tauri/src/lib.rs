mod db;
mod todo;

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

const TRAY_ID: &str = "main-tray";
const MENU_SHOW: &str = "show";
const MENU_AUTOSTART: &str = "autostart";
const MENU_QUIT: &str = "quit";

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
  if !(url.starts_with("http://") || url.starts_with("https://")) {
    return Err("仅允许打开 http/https 链接".to_string());
  }

  webbrowser::open(&url)
    .map(|_| ())
    .map_err(|error| format!("打开浏览器失败: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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

      let show_item = MenuItemBuilder::with_id(MENU_SHOW, "显示主窗口").build(app)?;
      let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
      let autostart_item = CheckMenuItemBuilder::with_id(MENU_AUTOSTART, "开机自启")
        .checked(autostart_enabled)
        .build(app)?;
      let quit_item = MenuItemBuilder::with_id(MENU_QUIT, "退出应用").build(app)?;
      let tray_menu = MenuBuilder::new(app)
        .items(&[&show_item, &autostart_item, &quit_item])
        .build()?;

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
            if let Some(window) = tray.app_handle().get_webview_window("main") {
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
        })
        .tooltip("行简")
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
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.show();
          let _ = window.set_focus();
        }
      }
      MENU_AUTOSTART => {
        let next_enabled = !app.autolaunch().is_enabled().unwrap_or(false);
        if next_enabled {
          let _ = app.autolaunch().enable();
        } else {
          let _ = app.autolaunch().disable();
        }

        if let Some(tray) = app.tray_by_id(TRAY_ID) {
          if let (Ok(show_item), Ok(autostart_item), Ok(quit_item)) = (
            MenuItemBuilder::with_id(MENU_SHOW, "显示主窗口").build(app),
            CheckMenuItemBuilder::with_id(MENU_AUTOSTART, "开机自启")
              .checked(next_enabled)
              .build(app),
            MenuItemBuilder::with_id(MENU_QUIT, "退出应用").build(app),
          ) {
            if let Ok(menu) = MenuBuilder::new(app)
              .items(&[&show_item, &autostart_item, &quit_item])
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
      open_external_url
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
