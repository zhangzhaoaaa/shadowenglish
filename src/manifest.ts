export default {
  manifest_version: 3,
  name: "Shadow Language Practice",
  version: "0.1.0",
  description: "Practice speaking with YouTube captions",
  permissions: ["sidePanel", "activeTab", "scripting", "storage", "tabs", "audioCapture"],
  host_permissions: ["*://*.youtube.com/*"],
  side_panel: {
    default_path: "sidepanel.html"
  }
}
