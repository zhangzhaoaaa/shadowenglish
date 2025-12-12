export default {
  manifest_version: 3,
  name: "Shadowing Practice",
  version: "0.1.0",
  description: "Practice shadowing languages using YouTube videos with looped segments and transcripts in a side panel",
  permissions: ["sidePanel", "activeTab", "scripting", "storage", "tabs", "audioCapture"],
  host_permissions: ["*://*.youtube.com/*"],
  side_panel: {
    default_path: "sidepanel.html"
  }
}
