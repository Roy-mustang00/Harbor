use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

/// Handle to the registered Android plugin class. Kept only so the
/// registration stays alive for the app's lifetime; v1 calls no commands
/// through it (see lib.rs).
pub struct HarborExoHandle<R: Runtime>(#[allow(dead_code)] pub PluginHandle<R>);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<HarborExoHandle<R>, Box<dyn std::error::Error>> {
    let handle = api.register_android_plugin("app.harbor.exoplayer", "HarborExoPlugin")?;
    Ok(HarborExoHandle(handle))
}
