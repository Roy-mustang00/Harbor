use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "android")]
mod mobile;

/// The registered Android plugin handle, kept in app state so the
/// registration outlives setup. Nothing calls commands through it in v1 —
/// playback is driven from the web UI through the Kotlin bridge object.
#[cfg(target_os = "android")]
pub struct HarborExoPlayer<R: Runtime>(#[allow(dead_code)] mobile::HarborExoHandle<R>);

/// Android-only plugin: registering it instantiates the Kotlin
/// `HarborExoPlugin`, whose `load(webView)` hook attaches the
/// `window.HarborExo` Media3 bridge to the app's WebView. On every other
/// platform the plugin is inert — the native player is an Android surface,
/// and the desktop builder never registers this plugin at all.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("harbor-exoplayer")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            app.manage(HarborExoPlayer(mobile::init(app, api)?));
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
